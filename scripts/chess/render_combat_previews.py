"""Preview renders of a Pawn combat library on the real rigs, spear and shield.

  python scripts/chess/render_combat_previews.py -- --sources PRIVATE/pawn-sources/manifest.json \
    --library web/src/assets/chess/combat-v2 --sockets web/src/assets/chess/combat-v1/prop-sockets.json \
    --output PRIVATE/previews --classes wp,bp [--only attack.thrust] [--size 320] [--step 2]

The original skinned Pawn is merged with the clips-only library in memory and
imported through Blender's own glTF importer, so the render is an independent
check that every channel binds to the real skeleton. Spear and shield are simple
stand-ins placed with the same hand-local frames `weapons.ts` gives the props.
Cycles on CPU at low resolution; writes <class>/<clip>.jpg contact sheets, the
rendered frames, and (with ffmpeg) <class>-montage.mp4.
"""
import argparse
import json
import math
from pathlib import Path
import struct
import subprocess
import sys

import bpy
from mathutils import Matrix, Vector
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import combat_retarget as cr  # noqa: E402

C = Matrix.Rotation(math.pi/2, 4, "X")


def merged_glb(rigged, library, path):
    """Rigged Pawn + library animations in one GLB (animations re-pointed by joint name)."""
    doc, blob = cr.read_glb(rigged); lib, lib_blob = cr.read_glb(library)
    blob = bytearray(blob); blob += b"\0"*((-len(blob)) % 4); base = len(blob); blob += lib_blob
    names = {n.get("name"): i for i, n in enumerate(doc["nodes"])}
    views = len(doc["bufferViews"]); accessors = len(doc["accessors"])
    for view in lib["bufferViews"]:
        doc["bufferViews"].append({**view, "buffer": 0, "byteOffset": base+view.get("byteOffset", 0)})
    for item in lib["accessors"]:
        doc["accessors"].append({**item, "bufferView": item["bufferView"]+views})
    doc["animations"] = []
    for animation in lib["animations"]:
        channels = []
        for channel in animation["channels"]:
            name = lib["nodes"][channel["target"]["node"]]["name"]
            if name in names and name != "Armature":
                channels.append({"sampler": channel["sampler"], "target": {"node": names[name], "path": channel["target"]["path"]}})
        samplers = [{**s, "input": s["input"]+accessors, "output": s["output"]+accessors} for s in animation["samplers"]]
        doc["animations"].append({"name": animation["name"], "channels": channels, "samplers": samplers})
    doc["buffers"] = [{"byteLength": len(blob)}]
    encoded = json.dumps(doc, separators=(",", ":")).encode(); encoded += b" "*((-len(encoded)) % 4)
    blob += b"\0"*((-len(blob)) % 4)
    data = struct.pack("<III", 0x46546C67, 2, 28+len(encoded)+len(blob))
    data += struct.pack("<II", len(encoded), 0x4E4F534A)+encoded+struct.pack("<II", len(blob), 0x004E4942)+bytes(blob)
    Path(path).write_bytes(data)


def material(name, color, metallic=0., rough=.6):
    m = bpy.data.materials.new(name); m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1); bsdf.inputs["Metallic"].default_value = metallic; bsdf.inputs["Roughness"].default_value = rough
    return m


def prop_mesh(name, parts):
    """parts: list of (kind, args, material). Geometry in prop-local glTF axes, metres."""
    import bmesh
    mesh = bpy.data.meshes.new(name); bm = bmesh.new(); mats = []
    for kind, args, mat in parts:
        if mat.name not in [m.name for m in mats]:
            mats.append(mat)
        index = [m.name for m in mats].index(mat.name); before = len(bm.faces)
        if kind == "shaft":          # along +Y from y0 to y1
            y0, y1, r0, r1 = args
            made = bmesh.ops.create_cone(bm, cap_ends=True, segments=10, radius1=r0, radius2=r1, depth=y1-y0)
            bmesh.ops.transform(bm, matrix=Matrix.Translation((0, (y0+y1)/2, 0)) @ Matrix.Rotation(-math.pi/2, 4, "X"), verts=made["verts"])
        elif kind == "disc":         # facing +Z at z, radius, thickness, dome height
            z, radius, thick, dome = args
            made = bmesh.ops.create_cone(bm, cap_ends=True, segments=24, radius1=radius, radius2=radius*.25 if dome else radius, depth=dome or thick)
            bmesh.ops.transform(bm, matrix=Matrix.Translation((0, 0, z)), verts=made["verts"])
        bm.faces.ensure_lookup_table()
        for face in bm.faces[before:]:
            face.material_index = index
    bm.to_mesh(mesh); bm.free()
    for m in mats:
        mesh.materials.append(m)
    obj = bpy.data.objects.new(name, mesh); bpy.context.scene.collection.objects.link(obj)
    return obj


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--sources", required=True); parser.add_argument("--library", required=True)
    parser.add_argument("--sockets", required=True); parser.add_argument("--output", required=True)
    parser.add_argument("--classes", default="wp,bp"); parser.add_argument("--only", default="")
    parser.add_argument("--size", type=int, default=320); parser.add_argument("--step", type=int, default=2)
    parser.add_argument("--samples", type=int, default=8); parser.add_argument("--threads", type=int, default=2)
    parser.add_argument("--tiles", type=int, default=8); parser.add_argument("--montage", default="1")
    argv = sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else sys.argv[1:]
    args = parser.parse_args(argv)
    from PIL import Image, ImageDraw
    rows = json.loads(Path(args.sources).read_text()); sockets = json.loads(Path(args.sockets).read_text())["archetypes"]
    out = Path(args.output); out.mkdir(parents=True, exist_ok=True)
    for key in args.classes.split(","):
        row = {r["role"]: r for r in rows if r["class"] == key}
        pawn = cr.PawnRig(key, row["rigged"]["path"], row["idle"]["path"], sockets[key])
        library = Path(args.library)/(key+".glb"); manifest = json.loads((Path(args.library)/(key+".json")).read_text())
        lib = cr.Skeleton(library)
        bpy.ops.wm.read_factory_settings(use_empty=True)
        merged = out/(key+"-merged.glb"); merged_glb(row["rigged"]["path"], library, merged)
        bpy.ops.import_scene.gltf(filepath=str(merged)); merged.unlink()
        scene = bpy.context.scene; scene.render.fps = 30
        for obj in list(scene.objects):
            if obj.type == "MESH" and obj.name.startswith("Icosphere"):
                bpy.data.objects.remove(obj)
        armature = next(o for o in scene.objects if o.type == "ARMATURE")
        # --- stand-in props (figure-height units of weapons.ts, in metres here)
        unit = pawn.stature; spec = cr.PROPS[key]
        wood = material("wood", (.35, .22, .12)); steel = material("steel", (.75, .77, .8), .9, .3)
        face = material("face", (.55, .12, .1) if key == "wp" else (.1, .35, .3)); floor_a = material("a", (.42, .40, .36)); floor_b = material("b", (.30, .29, .27))
        grip = pawn.props["spear"]["grip_height"]; tip = pawn.props["spear"]["tip_height"]
        spear = prop_mesh("spear", [("shaft", ((spec["spear"]["butt"]-grip)*unit, (tip-.19-grip)*unit, .013*unit, .012*unit), wood),
                                    ("shaft", ((tip-.19-grip)*unit, (tip-grip)*unit, .03*unit, .002*unit), steel)])
        radius = spec["shield"]["radius"]*unit
        shield = prop_mesh("shield", [("disc", (0, radius, .02*unit, 0), face), ("disc", (.03*unit, radius*.45, 0, .05*unit), steel)])
        frames_local = {
            "spear": np.block([[pawn.props["spear"]["basis"], pawn.props["spear"]["grip"][:, None]*pawn.scale], [np.zeros((1, 3)), np.ones((1, 1))]]),
            "shield": np.block([[pawn.props["shield"]["basis"], pawn.props["shield"]["center"][:, None]*pawn.scale], [np.zeros((1, 3)), np.ones((1, 1))]]),
        }
        # --- stage: board squares, an opponent marker at the standoff, light, camera
        square = 1/sockets[key]["normalizationScale"]
        import bmesh
        mesh = bpy.data.meshes.new("board"); bm = bmesh.new()
        for ix in range(-2, 2):
            for iz in range(-2, 2):
                verts = [bm.verts.new(((ix+dx+.5)*square, -(iz+dz+.5)*square, 0)) for dx, dz in ((0, 0), (1, 0), (1, 1), (0, 1))]
                bm.faces.new(verts).material_index = (ix+iz) % 2
        bm.to_mesh(mesh); bm.free(); mesh.materials.append(floor_a); mesh.materials.append(floor_b)
        scene.collection.objects.link(bpy.data.objects.new("board", mesh))
        standoff = sockets[key]["standoffUnits"]*square
        post = prop_mesh("opponent", [("shaft", (0, 1.7, .05, .05), material("ghost", (.9, .75, .2)))])
        post.matrix_world = C @ Matrix.Translation((0, 0, standoff+.25))
        sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); sun.data.energy = 3.5; sun.rotation_euler = (.9, .1, -.9); scene.collection.objects.link(sun)
        world = bpy.data.worlds.new("w"); world.use_nodes = True; world.node_tree.nodes["Background"].inputs[0].default_value = (.55, .6, .7, 1)
        world.node_tree.nodes["Background"].inputs[1].default_value = .9; scene.world = world
        camera = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); scene.collection.objects.link(camera); scene.camera = camera
        camera.data.type = "ORTHO"; camera.data.ortho_scale = 3.3
        scene.render.engine = "CYCLES"; scene.cycles.device = "CPU"; scene.cycles.samples = args.samples; scene.cycles.use_denoising = False
        scene.cycles.max_bounces = 2; scene.render.threads_mode = "FIXED"; scene.render.threads = args.threads
        scene.render.resolution_x = args.size; scene.render.resolution_y = args.size; scene.render.image_settings.file_format = "JPEG"
        scene.render.image_settings.quality = 85; scene.view_settings.view_transform = "Standard"
        montage = []
        for clip in manifest["clips"]:
            if args.only and clip["id"] not in args.only.split(","):
                continue
            action = bpy.data.actions.get(clip["id"]) or next(a for a in bpy.data.actions if a.name.startswith(clip["id"]))
            armature.animation_data_create(); armature.animation_data.action = action
            if hasattr(armature.animation_data, "action_slot") and action.slots:
                armature.animation_data.action_slot = action.slots[0]
            last = int(round(clip["duration"]*30)); frames = sorted(set(list(range(0, last+1, args.step))+[last]))
            worlds = lib.fk(*lib.sample(clip["id"], np.array(frames)/30))
            hips = worlds[:, lib.index["Hips"], :3, 3]; mid = (hips.min(0)+hips.max(0))/2
            target = Vector((mid[0], -mid[2]-.35, .85)); camera.location = target+Vector((-4.2, -4.6, 2.2))
            camera.rotation_euler = (target-camera.location).to_track_quat("-Z", "Y").to_euler()
            folder = out/key/"frames"/clip["id"]; folder.mkdir(parents=True, exist_ok=True)
            marks = {}
            for m in clip["markers"]:
                if not m["name"].startswith("foot_") and m["name"] not in ("start", "end", "impact"):
                    marks.setdefault(m["frame"], []).append(m["name"])
            images = []
            for n, frame in enumerate(frames):
                scene.frame_set(frame)
                for name, hand in (("spear", "RightHand"), ("shield", "LeftHand")):
                    m = worlds[n, lib.index[hand]] @ frames_local[name]
                    m[:3, :3] /= np.linalg.norm(m[:3, :3], axis=0)
                    (spear if name == "spear" else shield).matrix_world = C @ Matrix(m.tolist())
                scene.render.filepath = str(folder/f"{frame:04d}.jpg")
                bpy.ops.render.render(write_still=True)
                image = Image.open(scene.render.filepath).convert("RGB"); draw = ImageDraw.Draw(image)
                draw.text((4, 3), f"{key}  {clip['id']}", fill=(255, 255, 255)); draw.text((4, 15), f"f{frame} {frame/30:.2f}s", fill=(255, 255, 160))
                near = [f"{name}@{f}" for f, names in marks.items() for name in names if min(frames, key=lambda x: abs(x-f)) == frame]
                if near:
                    draw.text((4, args.size-14), " ".join(sorted(set(near))), fill=(120, 255, 120))
                image.save(scene.render.filepath, quality=85); images.append((frame, image))
            # contact sheet: evenly spaced tiles, always including named events
            wanted = {frames[int(round(i*(len(frames)-1)/(args.tiles-1)))] for i in range(args.tiles)}
            for f in marks:
                wanted.add(min(frames, key=lambda x: abs(x-f)))
            tiles = [im for fr, im in images if fr in wanted]; cols = min(len(tiles), 6); rows_n = math.ceil(len(tiles)/cols)
            sheet = Image.new("RGB", (cols*args.size, rows_n*args.size), "black")
            for i, im in enumerate(tiles):
                sheet.paste(im, ((i % cols)*args.size, (i//cols)*args.size))
            sheet.save(out/key/(clip["id"]+".jpg"), quality=82)
            montage += [folder/f"{frame:04d}.jpg" for frame in frames]
            montage += [folder/f"{frames[-1]:04d}.jpg"]*max(2, 8//args.step)
            print("RENDERED", key, clip["id"], len(frames), flush=True)
        if args.montage == "1" and montage:
            listing = out/(key+"-montage.txt"); rate = 30/args.step
            listing.write_text("".join(f"file '{p}'\nduration {1/rate:.5f}\n" for p in montage))
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(listing), "-vf", f"fps={rate}",
                            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "27", str(out/(key+"-montage.mp4"))], check=True)
            listing.unlink()


if __name__ == "__main__":
    main()
