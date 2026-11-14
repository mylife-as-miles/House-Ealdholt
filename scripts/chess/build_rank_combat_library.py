"""Bake Crownfall's rank combat libraries: Knights, Rooks and Kings.

One clips-only library per figure, baked for that figure's own rig
(`web/src/assets/chess/combat-ranks/<key>.glb`, version `crownfall-rank-combat-1`):

  attack.strike    the figure's own strike, cut round the blow, with ready / contact / impact / recovery
  death.<way>      its own death, with hit / land, named by the way the body falls
  defend.*, hit.*  guards and hits from the Meshy animation library, bought for a figure's rig, or moved
                   onto a figure of the same class whose rig was not bought for (`MOVED`)

Every clip goes through `combat_retarget.retarget`, which this script imports and never changes (the Pawn
libraries pin its hash): world-space rotation deltas from the source's bind pose onto the target's, the
pelvis path, planted-foot IK. A figure's own clips are retargeted from its own rig, which keeps the authored
motion and puts every limb back at the rig's own length (Meshy's library leaves them a few centimetres off).
Markers are read off the baked motion, never guessed from clip fractions.

Runs under Blender 5.2 for its numpy, through the house launcher:

  python lib/run_blender.py <repo>/scripts/chess/build_rank_combat_library.py --timeout 1800 -- \
    --cache <private download folder> [--cache <folder> ...] \
    --output <repo>/web/src/assets/chess/combat-ranks [--classes wn,bn] [--inspect]

Sources are pinned by SHA-256 in FIGURES and PURCHASES. Files inside the repository are read in place; the
Aethelgard (Rork) figures and the Meshy purchases are found in the cache folders by that hash.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import struct
import sys

import numpy as np

sys.dont_write_bytecode = True                       # no __pycache__ left beside the scripts in the repository
sys.path.insert(0, str(Path(__file__).resolve().parent))
import combat_retarget as cr  # noqa: E402  (retargeting, pose solving and foot locks are shared with combat-v2)

FPS = cr.FPS
VERSION = "crownfall-rank-combat-1"
REPO = Path(__file__).resolve().parents[2]
PUBLIC = REPO/"main game"/"public"
RORK = "https://r2-pub.rork.com/generated-3d-models/g9111r67kl6tq85g540sd/"
# The 22 joints a Meshy humanoid shares with every other: the identity map of combat_retarget's BONE_MAPS.
JOINTS = ("Hips", "Spine02", "Spine01", "Spine", "neck", "Head",
          "LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand", "RightShoulder", "RightArm", "RightForeArm", "RightHand",
          "LeftUpLeg", "LeftLeg", "LeftFoot", "LeftToeBase", "RightUpLeg", "RightLeg", "RightFoot", "RightToeBase")
# A strike keeps at least LEAD before its drive and TAIL after its recovery, and at most WINDUP before the blow:
# the wind-up stays, the idle lead-in goes.
LEAD, TAIL, WINDUP = .3, .45, 1.6
# A guard keeps GUARD_LEAD of the arm coming up; a side hit keeps SIDE_HOLD after the blow.
GUARD_LEAD, SIDE_HOLD = .5, 1.5

MESHY_RIG = "Meshy image-to-3D (meshy-t2.5, meshy-n1 texture) and Meshy auto-rig: 24-joint humanoid"
RORK_RIG = "Rork generated figure, rigged by Rork's pipeline on the same 24-joint humanoid"
LICENCES = {
    "meshy": "Generated with the Crownfall creator's Meshy account (meshy.ai); Meshy's terms of service govern the output.",
    "rork": "Generated with the Crownfall creator's Rork account (rork.com); Rork's terms govern the output.",
}


def src(url, sha256, size, **extra):
    return dict(url=url, sha256=sha256, bytes=size, **extra)


def rork(name, sha256, size, **extra):
    return src(RORK+name, sha256, size, maker="rork", **extra)


def meshy(url, sha256, size, task, action, action_id, **extra):
    return src(url, sha256, size, maker="meshy", task=task, action=action, actionId=action_id, **extra)


# Strike drivers: what carries the blow (the weapon hand, both hands on a haft, or the kicking foot). The Charged
# Slash swings twice, forehand then backhand (`twoBlows`).
FIGURES = {
    "wn": dict(kingdom="ivory", kind="n", figure="Aethelgard Knight", weapon="longsword and heater shield",
               rig=rork("43f08150-5463-4112-9949-2e1a9a9a6bd2-rigged.glb", "c6f3e9c4482231818097e050fc94b0208e17767c0c790a156791bc9576a5ad29", 977324, made=RORK_RIG),
               attack=rork("43f08150-5463-4112-9949-2e1a9a9a6bd2-anim-charged-slash.glb", "b1c986562fe09142d1cdde64d45464d9ec52bf4e8b1ea4b6d3fe3f87e5b456cf", 47140, action="Charged Slash"),
               death=rork("43f08150-5463-4112-9949-2e1a9a9a6bd2-anim-dying-backwards.glb", "2562d415c53bd408dbe9ebc5b5c6fc87e6d16e371c8fdf5396a75eb2991ff5b0", 45032, action="Dying Backwards"),
               strike=dict(driver="RightHand", twoBlows=True, tags=["blade", "slash"])),
    "wr": dict(kingdom="ivory", kind="r", figure="Aethelgard Rook", weapon="warhammer and tower shield",
               rig=rork("211b0ba5-2c7f-44ff-8143-b625bca41df1-rigged.glb", "7de1709310d9491e64ca06c5fb233e3ef755bcf493268eec5f803cb880ee8ba9", 976996, made=RORK_RIG),
               attack=rork("211b0ba5-2c7f-44ff-8143-b625bca41df1-anim-heavy-hammer-swing.glb", "763b3e3012cc935b212b7000a8cdb2566a7d5034a68d3b0b73b8c071e9b9e0a2", 40616, action="Heavy Hammer Swing"),
               death=rork("211b0ba5-2c7f-44ff-8143-b625bca41df1-anim-knock-down.glb", "71a9118080dec18baffca9ca27988ecc09bb20ce85c3d4f13d42340d4f0ec996", 56864, action="Knock Down"),
               strike=dict(driver="RightHand", tags=["hammer", "overhead"])),
    "wk": dict(kingdom="ivory", kind="k", figure="Aethelgard King", weapon="greatsword",
               rig=rork("704a772c-4a50-4619-b5ad-6e2bbf9703b8-rigged.glb", "d0e09201d4ddc3a083279b9635605994dfae6a5afdca0085504d0c9aeec48ec7", 1177560, made=RORK_RIG),
               attack=rork("704a772c-4a50-4619-b5ad-6e2bbf9703b8-anim-sword-judgment.glb", "a21b4e4f488bf9780960dbf71f12fc7a375398cffa42ca1386c09ecefb628697", 72260, action="Sword Judgment"),
               death=rork("704a772c-4a50-4619-b5ad-6e2bbf9703b8-anim-dead.glb", "c3ef8ad1284d198b6eae93dc0dcf89523e69da7d566438f9ea0cb1869f5d4c98", 53084, action="Dead"),
               strike=dict(driver="RightHand", tags=["blade", "overhead"])),
    "bn": dict(kingdom="sun", kind="n", figure="Solforiz Knight, the Dune Reaver", weapon="hooked cleaver and riveted buckler",
               rig=src("/models/solforiz/n-rigged.glb", "d27b72e6b0fbc52388ad62e11d6ba74b27dd56e9e25925befa64ba31b751a601", 1187152, made=MESHY_RIG, maker="meshy", task="01a1c64d-5096-7568-bda2-ee36b7e9c683"),
               attack=meshy("/models/solforiz/n-attack.glb", "48d87a01857882608bccecd40c3290f0067ff1e09dfe46e70ab5c2407809384a", 43568, "01a1c64e-f0fc-77d5-b919-d081a0d68f9d", "Charged Slash", 242),
               death=meshy("/models/solforiz/n-death.glb", "bed1fc3d799d0c1f8daf5afa80d4603abbeb74e96214b1679839fbd26233e364", 43572, "01a1c64e-f0fc-77d5-b919-d081a0d68f9d", "Dying Backwards", 189),
               strike=dict(driver="RightHand", twoBlows=True, tags=["blade", "slash"])),
    "br": dict(kingdom="sun", kind="r", figure="Solforiz Rook, the Furnace Bastion", weapon="piston maul and furnace shield",
               rig=src("/models/solforiz/r-rigged.glb", "2cb3034df3eacc7af4dfcf85206a8657609673be7271c544058a9f8f08863533", 1155268, made=MESHY_RIG, maker="meshy", task="01a1c64e-e320-753a-8ad2-8eec51a4278d"),
               attack=meshy("/models/solforiz/r-attack.glb", "1ce791654a62f6247a69f7ecafe08d3315f1ed991f73aa7bb7d81af233aa726d", 40152, "01a1c653-4e84-706f-aa2a-09d549cc0b57", "Heavy Hammer Swing", 128),
               death=meshy("/models/solforiz/r-death.glb", "ebf22cd55ede461bb609f686a08b14227ca4fd4d3bfa9a93a3a710f11e750878", 52848, "01a1c653-4e84-706f-aa2a-09d549cc0b57", "Knock Down", 187),
               strike=dict(driver="RightHand", tags=["hammer", "overhead"])),
    "bk": dict(kingdom="sun", kind="k", figure="Solforiz King, the Scorched Sovereign", weapon="sovereign sunblade",
               rig=src("/models/solforiz/k-rigged.glb", "2e50b8ecea60fc5f5f2d5062088356e28a18f87148f6201905e1dc7055f9dade", 1340580, made=MESHY_RIG, maker="meshy", task="01a1c646-af39-7711-a82f-eff4c7b47240"),
               attack=meshy("/models/solforiz/k-attack.glb", "8d7d31992085ce126de32a1c0696c431a2b2d1195388ae21edfa9d38aa1a3da8", 61964, "01a1c64b-9bcc-7520-8d0d-0a54f3538889", "Sword Judgment", 102),
               death=meshy("/models/solforiz/k-death.glb", "f8dac7063ce99e4b42ebbeb9fafbbfed6c5f7b3ea79af96258d1fec9b913e482", 50316, "01a1c64b-9bcc-7520-8d0d-0a54f3538889", "Dead", 8),
               strike=dict(driver="RightHand", tags=["blade", "overhead"])),
    "en": dict(kingdom="empire", kind="n", figure="Korvenia Knight, the Eclipse Cuirassier", weapon="cavalry sabre",
               rig=src("/models/korvenia/n-rigged.glb", "3ef2ff7b777ae4063332031e69e3281643ff56cb83745044acdba174cea2583d", 1270000, made=MESHY_RIG, maker="meshy", task="01a1c5d9-1aec-76fb-94ad-6017917136aa"),
               attack=meshy("/models/korvenia/n-attack.glb", "ccbf543782e08edc3a1943f641cce88d9956403e85c2417bcbcd7d9cf8613000", 43580, "01a1c5db-dd08-770f-ab46-576dc5081def", "Charged Slash", 242),
               death=meshy("/models/korvenia/n-death.glb", "01a4105aa763666550fe44e060bf57a26fa5a79ebfab4bad15268e11e99d4706", 43576, "01a1c5db-dd08-770f-ab46-576dc5081def", "Dying Backwards", 189),
               strike=dict(driver="RightHand", twoBlows=True, tags=["blade", "slash"])),
    "kn": dict(kingdom="kwind", kind="n", figure="Kwind-09 Knight, the Expressway Courier", weapon="none: he kicks",
               rig=src("/models/kwind09/n-rigged.glb", "e6c0a190c5cdd811016d217868316a5ceb25ca4c6d62bdb65043f178cade1fb0", 1019512, made=MESHY_RIG, maker="meshy", task="01a1c4aa-48be-775b-9bfe-4a8baa8a5069"),
               attack=meshy("/models/kwind09/n-attack.glb", "0b0faad14d7c49447708d98bcea6783a6b512e03bfcc0272d63e7bbfb6098dda", 50804, "01a1c4f2-34ab-770b-bf17-5c2add86fcb4", "Lunge Roundhouse Kick", 208),
               death=meshy("/models/kwind09/n-death.glb", "ce2ab3c936095852d3f60d94d2cd457a61c371f377a0fe20ad5e8ed0e39459ec", 47272, "01a1c4f2-34ab-770b-bf17-5c2add86fcb4", "Knock Down", 187),
               strike=dict(driver="foot", tags=["kick", "unarmed"])),
    "kr": dict(kingdom="kwind", kind="r", figure="Kwind-09 Rook, the Foundry Bulwark", weapon="steam maul",
               rig=src("/models/kwind09/r-rigged.glb", "a979472a614d13a1eea9d533ccf2a8e1661216b8135fcfbee1823366d0ce9a56", 1020028, made=MESHY_RIG, maker="meshy", task="01a1c4aa-605b-7253-ae56-b3a693250fd3"),
               attack=meshy("/models/kwind09/r-attack.glb", "6677cb684448c02ea3d5a79b0b8f28353f360545aa38c39af3ac61c4620df8f1", 50628, "01a1c4f2-0ec9-7303-ad43-393ed86f4c15", "Charged Ground Slam", 127),
               death=meshy("/models/kwind09/r-death.glb", "e94712650b98715efdf8bdacd7f60dea0a92ab014a4ffa8d6967601169d49304", 54868, "01a1c4f2-0ec9-7303-ad43-393ed86f4c15", "Fall Dead from Abdominal Injury", 188),
               strike=dict(driver="hands", tags=["hammer", "slam"])),
    "kk": dict(kingdom="kwind", kind="k", figure="Kwind-09 King, the Chairman", weapon="arc cane",
               rig=src("/models/kwind09/k-rigged.glb", "de4ec4f974eb40705e2a5b0814f5743f6f90bc4798e529febf946988f3cec0aa", 1073464, made=MESHY_RIG, maker="meshy", task="01a1c4aa-0109-7591-bb02-cd9b20222804"),
               attack=meshy("/models/kwind09/k-attack.glb", "e3d87bb9d8fecd1923a30b0228e186131713c1d451ba3f6cb3fb5fc7418dc8b7", 62056, "01a1c4f2-0166-759a-b13c-aaab29d3d820", "Sword Judgment", 102),
               death=meshy("/models/kwind09/k-death.glb", "9713cd0ae145351159ca06ad5483ced6db15cd3e410541c1828f4c7005b5ebb3", 50412, "01a1c4f2-0166-759a-b13c-aaab29d3d820", "Dead", 8),
               strike=dict(driver="RightHand", tags=["blade", "overhead"])),
}

# Meshy animation-library actions bought for a figure's rig: one animate task each, one clip per action.
#   kind   block: guard read off the hand that comes up; hit: recoil read off the chest; death: fall and landing
#   cut    "fall": the hit ends where the authored fall begins (its own `death` is the whole clip)
#   sides  the authored reaction names its own side from the motion; the mirror image is the other side
PURCHASES = {
    "bn": dict(task="01a1cc47-048c-731b-9acd-a83ef647c00c", rigTask="01a1c64d-5096-7568-bda2-ee36b7e9c683", bought="2026-11-11", credits=12,
               file=src("meshy:animation/01a1cc47-048c-731b-9acd-a83ef647c00c/merged_animations.glb",
                        "bfda362bbe3c2df42d335bc35396af0e47365e4d233a3eba8ce258f32d1231d3", 4575192),
               clips=[
                   dict(id="defend.block", kind="block", clip="Block9", action="Block9", actionId=145, tags=["defense", "block", "shield"]),
                   dict(id="hit.front", kind="hit", clip="Hit_Reaction", action="Hit Reaction", actionId=178, tags=["hit", "front", "heavy"]),
                   dict(id="hit.back", kind="hit", clip="Shot_in_the_Back_and_Fall", action="Shot in the Back and Fall", actionId=180, cut="fall", tags=["hit", "back"]),
                   dict(id="death.forward", kind="death", clip="Shot_in_the_Back_and_Fall", action="Shot in the Back and Fall", actionId=180, tags=["death", "forward", "back"]),
                   dict(id="hit.side", kind="hit", clip="Slap_Reaction", action="Slap Reaction", actionId=173, sides=True, tags=["hit"]),
               ]),
}
# A figure whose class-mate's rig was bought for gets those clips retargeted onto its own rig, from the figure
# whose fighting style matches (the Aethelgard and Solforiz Knights both carry a blade and a shield on the left arm).
MOVED = {"wn": "bn"}


# ------------------------------------------------------------------ sources
def sha256(data):
    return hashlib.sha256(data).hexdigest()


class Sources:
    """Pinned inputs: repository files in place, the rest found in the cache folders by SHA-256."""

    def __init__(self, caches):
        self.found = {}
        for folder in caches:
            for path in sorted(Path(folder).rglob("*.glb")):
                self.found.setdefault(sha256(path.read_bytes()), path)

    def path(self, entry):
        if entry["url"].startswith("/models/"):
            path = PUBLIC/entry["url"].lstrip("/")
        else:
            path = self.found.get(entry["sha256"])
            if path is None:
                raise FileNotFoundError(f"{entry['url']}: no cached file with SHA-256 {entry['sha256']}")
        data = path.read_bytes()
        if len(data) != entry["bytes"] or sha256(data) != entry["sha256"]:
            raise ValueError(f"{entry['url']}: source bytes changed; refusing to bake")
        return path


class RankRig:
    """A figure's pinned rig as combat_retarget's target: bind-pose frames, ankle heights, armature scale."""

    def __init__(self, key, rigged):
        self.key = key; self.skel = cr.Skeleton(rigged); sk = self.skel
        self.rest_world = sk.fk(*sk.sample(None, [0]))[0]
        self.rest_pos = self.rest_world[:, :3, 3]; self.rest_rot = cr.world_rot(self.rest_world)
        self.joints = sorted({j for skin in sk.doc["skins"] for j in skin["joints"]})
        self.id = lambda name: sk.index[name]
        feet = [self.rest_pos[self.id(n)][1] for n in ("LeftToeBase", "RightToeBase", "LeftFoot", "RightFoot")]
        # The board is where the toes rest in the bind pose: Meshy and Rork rigs stand on y = 0, give or take a sole.
        self.ground = float(min(0., min(feet)))
        self.ankle = {s: self.rest_pos[self.id(s+"Foot")][1] for s in ("Left", "Right")}
        self.scale = float(np.linalg.norm(self.rest_world[self.id("Hips"), :3, 0]))
        self.height = float(self.rest_pos[self.id("Head")][1]-self.ground)
        # Joints and their ancestors (the Armature): the nodes a clips-only library carries.
        keep = set(self.joints)
        for j in list(keep):
            p = sk.parent[j]
            while p >= 0 and p not in keep:
                keep.add(p); p = sk.parent[p]
        self.nodes = [i for i in sk.order if i in keep]
        toes = self.rest_pos[self.id("LeftToeBase")]-self.rest_pos[self.id("LeftFoot")]
        if toes[2] <= 0:
            raise ValueError(f"{key}: rig does not face +Z")


class MeshySource:
    """A clip as combat_retarget's source: the identity map of the shared skeleton, with the bind pose read from
    the rig the clip was made on (a clips-only file's node frames are not always that rig's bind pose)."""

    def __init__(self, clip_path, rig_path, clip=None):
        self.family = "meshy"; self.map = {name: name for name in JOINTS}
        self.skel = cr.Skeleton(clip_path); sk = self.skel
        self.clip = clip or next(iter(sk.animations))
        bind = cr.Skeleton(rig_path)
        for i, name in enumerate(sk.names):          # nodes a clip does not key take the rig's bind frames
            if name in bind.index:
                b = bind.index[name]; sk.rest_t[i] = bind.rest_t[b]; sk.rest_r[i] = bind.rest_r[b]; sk.rest_s[i] = bind.rest_s[b]
        rest = bind.fk(*bind.sample(None, [0]))[0]
        self.rest_world = rest
        self.rest_pos = {t: rest[bind.index[s], :3, 3] for t, s in self.map.items()}
        self.rest_rot = {t: cr.world_rot(rest[bind.index[s]][None])[0] for t, s in self.map.items()}
        toes = self.rest_pos["LeftToeBase"]-self.rest_pos["LeftFoot"]
        if toes[2] <= 0:
            raise ValueError("Source rig does not face +Z")

    def duration(self):
        return self.skel.duration(self.clip)


# ------------------------------------------------------------------ markers
def _first(mask, default=None):
    hits = np.nonzero(mask)[0]
    return int(hits[0]) if len(hits) else default


def plants_to_events(info, last):
    events = []
    for side, spans in info["plants"].items():
        if not spans or spans[0][0] > 0:
            events.append((f"foot_{side.lower()}_lift", 0))
        for a, b in spans:
            events.append((f"foot_{side.lower()}_plant", a))
            if b < last:
                events.append((f"foot_{side.lower()}_lift", b+1))
    return events


def strike_track(pose, spec):
    """The path of what carries the blow: the weapon hand, both hands on a haft, or the kicking foot."""
    if spec["driver"] == "foot":
        ext = {side: np.linalg.norm((pose.pos(side+"Foot")-pose.pos("Hips"))[:, [0, 2]], axis=1) for side in ("Left", "Right")}
        side = max(ext, key=lambda s: ext[s].max())
        return pose.pos(side+"Foot"), side+"Foot"
    names = ["LeftHand", "RightHand"] if spec["driver"] == "hands" else [spec["driver"]]
    return np.mean([pose.pos(n) for n in names], axis=0), "+".join(names)


def strike_markers(pose, spec):
    """Contact: the driver at its fastest while it is in front of the body (a cut, a smash and a kick all land at
    full speed; the wind-up behind the back does not count). Ready: the last near-still frame before the run of
    speed into the blow. Recovery: the driver back under 15% of that speed for three frames. A clip with two
    swings (`twoBlows`) also marks the first as `clash`, so a sequence can have it parried and the second kill."""
    F = pose.frames; last = F-1
    track, driver = strike_track(pose, spec)
    hips = pose.pos("Hips")
    speed = np.linalg.norm(np.gradient(track, axis=0), axis=1)*FPS
    # A roundhouse arrives from the side, so any point of a kick counts; a hand must be ahead of the pelvis.
    front = np.ones(F, bool) if spec["driver"] == "foot" else (track[:, 2]-hips[:, 2]) > .1
    contact = int(np.argmax(np.where(front, speed, 0.)))
    vmax = max(float(speed[contact]), 1e-6)
    drive = contact
    while drive > 0 and speed[drive-1] >= .1*vmax:
        drive -= 1
    ready = max(0, drive-1)
    settle = next((f for f in range(contact+1, F-2) if (speed[f:f+3] < .15*vmax).all()), None)
    events = [("start", 0), ("end", last), ("ready", ready), ("contact", contact), ("impact", contact)]
    clash = None
    if spec.get("twoBlows"):
        # The first swing: the fastest moment in front before the blow, at least 40% of its speed, with the
        # driver slowing under 35% of it in between.
        window = range(ready+1, contact-5)
        peaks = [f for f in window if front[f] and speed[f] >= .4*vmax and speed[f] >= speed[f-1] and speed[f] >= speed[f+1]
                 and speed[f:contact].min() < .35*vmax]
        if peaks:
            clash = max(peaks, key=lambda f: speed[f]); events.append(("clash", clash))
    if settle is not None and settle < last:
        events.append(("recovery", settle))
    return events, dict(driver=driver, contact=contact, clash=clash, ready=ready, drive=drive, recovery=settle,
                        speed=round(vmax, 2), reachMetres=float(np.linalg.norm((track[contact]-hips[contact])[[0, 2]])))


def guard_markers(pose):
    """Guard: the hand that comes up reaches 95% of its travel; recovery: back under 30% of it."""
    F = pose.frames; last = F-1
    chest = pose.pos("Spine")
    travel = {}
    for hand in ("LeftHand", "RightHand"):
        rel = pose.pos(hand)-chest
        travel[hand] = np.linalg.norm(rel-rel[0], axis=1)
    hand = max(travel, key=lambda h: travel[h].max()); w = travel[hand]/max(travel[hand].max(), 1e-6)
    guard = _first(w >= .95, last)
    events = [("start", 0), ("end", last), ("guard", guard)]
    drop = _first((np.arange(F) > guard) & (w < .3), None)
    if drop is not None and drop < last:
        events.append(("recovery", drop))
    return events, dict(hand=hand, guard=guard, recovery=drop)


def hit_markers(pose, kind):
    """combat-v2's reading: hit is the frame before the chest reaches 15% of its peak speed; a death lands where
    pelvis or chest first comes within 3 cm of its lowest; a hit recovers where the chest is back within 15%."""
    F = pose.frames; last = F-1
    chest = pose.pos("Spine"); hips = pose.pos("Hips")
    speed = np.linalg.norm(np.gradient(chest, axis=0), axis=1)*FPS
    onset = _first(speed >= .15*speed.max(), 0)
    events = [("start", 0), ("end", last), ("hit", max(0, onset-1))]
    found = dict(hit=max(0, onset-1))
    if kind == "death":
        land = min(_first(track <= track.min()+.03, last) for track in (hips[:, 1], chest[:, 1]))
        events.append(("land", land)); found["land"] = land
    else:
        away = np.linalg.norm(chest-chest[-1], axis=1); peak = int(np.argmax(away))
        settle = _first((np.arange(F) > peak) & (away < .15*away[peak]), None)
        if settle is not None and settle < last:
            events.append(("recovery", settle)); found["recovery"] = settle
    return events, found


def fall_way(pose):
    """Which way the body goes down, from where the chest ends against where it began, in the rig's own frame
    (+Z its front, +X its left)."""
    d = pose.pos("Spine")[-1]-pose.pos("Spine")[0]
    angle = math.degrees(math.atan2(d[0], d[2]))
    if abs(angle) <= 50:
        return "forward"
    if abs(angle) >= 130:
        return "backward"
    return "left" if angle > 0 else "right"


def lean_side(pose, hit_frame):
    """Which side a reaction throws the head to after the blow: +X is the rig's left. Struck on the right, the
    head goes left."""
    head = pose.pos("Head"); x = head[hit_frame:, 0]-head[hit_frame, 0]
    peak = x[int(np.argmax(np.abs(x)))]
    return "right" if peak > 0 else "left"   # thrown to its left means the blow came from its right


def fall_frame(pose):
    """Where a fall begins: the pelvis drops below 90% of its standing height for good."""
    hips = pose.pos("Hips")[:, 1]; stand = hips[0]
    below = hips < .9*stand
    for f in range(len(hips)):
        if below[f:].all():
            return f
    return len(hips)-1


# ------------------------------------------------------------------ baking
def bake(target, source, start=None, end=None, **options):
    pose, info = cr.retarget(target, source, source.clip, start=start, end=end, **options)
    return pose, info


def clip_record(key, clip_id, tags, pose, events, source, extra=None):
    markers = []
    seen = set()
    for name, frame in sorted(events, key=lambda e: (e[1], e[0])):
        if (name, frame) in seen:
            continue
        seen.add((name, frame)); markers.append(dict(name=name, frame=int(frame), time=frame/FPS))
    record = dict(id=clip_id, version=VERSION, archetype=key, tags=list(tags), fps=FPS, duration=(pose.frames-1)/FPS,
                  markers=markers, source=source)
    if extra:
        record.update(extra)
    return record


def cut_strike(target, source, spec, options):
    """The strike from just before anything moves (its wind-up kept, unless that runs longer than WINDUP before
    the blow) to a little after it recovers."""
    pose, info = bake(target, source, **options)
    events, found = strike_markers(pose, spec)
    total = source.duration()
    begin = _motion_start(pose)/FPS-.1
    start = max(0., begin, found["contact"]/FPS-WINDUP)
    start = min(start, max(0., found["ready"]/FPS-LEAD))
    stop = min(total, ((found["recovery"] if found["recovery"] is not None else pose.frames-1)/FPS)+TAIL)
    pose, info = bake(target, source, start=start, end=stop, **options)
    events, found = strike_markers(pose, spec)
    events += plants_to_events(info, pose.frames-1)
    return pose, info, events, found, (start, stop)


def node_frames(target, pose):
    """Local translation / rotation / scale of every library node, per frame."""
    sk = target.skel
    out = {}
    for i in target.nodes:
        t = pose.local_t[:, i].copy(); r = pose.local_r[:, i].copy(); s = np.tile(sk.rest_s[i], (pose.frames, 1))
        for f in range(1, pose.frames):                 # one hemisphere, so linear keys never take the long way
            if np.dot(r[f], r[f-1]) < 0:
                r[f] = -r[f]
        out[i] = (t, r, s)
    return out


def write_library(target, records, poses, destination):
    """A clips-only GLB: the rig's joints and Armature, one animation per clip, the crownfall metadata as extras.
    Channels that never move are two keys; the pelvis and every rotation are keyed per frame."""
    sk = target.skel
    index = {i: n for n, i in enumerate(target.nodes)}
    nodes = []
    for i in target.nodes:
        node = dict(name=sk.names[i])
        children = [index[c] for c in sk.children(i) if c in index]
        if children:
            node["children"] = children
        t, r, s = sk.rest_t[i], sk.rest_r[i], sk.rest_s[i]
        if np.abs(t).max() > 0:
            node["translation"] = [float(v) for v in t]
        if np.abs(r-[0, 0, 0, 1]).max() > 0:
            node["rotation"] = [float(v) for v in r]
        if np.abs(s-1).max() > 0:
            node["scale"] = [float(v) for v in s]
        nodes.append(node)
    roots = [index[i] for i in target.nodes if sk.parent[i] not in index]
    doc = dict(asset=dict(version="2.0", generator=f"{VERSION} / build_rank_combat_library.py"), scene=0,
               scenes=[dict(name="Scene", nodes=roots)], nodes=nodes, animations=[], accessors=[], bufferViews=[])
    blob = bytearray()

    def add(values, kind, minmax=False):
        nonlocal blob
        values = np.asarray(values, np.float32)
        blob += b"\0"*((-len(blob)) % 4)
        data = values.astype("<f4").tobytes(); view = len(doc["bufferViews"])
        doc["bufferViews"].append(dict(buffer=0, byteOffset=len(blob), byteLength=len(data)))
        blob += data
        record = dict(bufferView=view, componentType=5126, count=int(values.shape[0]), type=kind)
        if minmax:
            record.update(min=[float(values.min())], max=[float(values.max())])
        doc["accessors"].append(record)
        return len(doc["accessors"])-1

    for record, pose in zip(records, poses):
        frames = pose.frames; times = np.arange(frames)/FPS
        full = add(times[:, None], "SCALAR", True); pair = add(np.array([[0.], [times[-1]]]), "SCALAR", True)
        animation = dict(name=record["id"], channels=[], samplers=[], extras=dict(crownfall=record))
        for i, (t, r, s) in node_frames(target, pose).items():
            for channel, values, kind in (("translation", t, "VEC3"), ("rotation", r, "VEC4"), ("scale", s, "VEC3")):
                constant = np.abs(values-values[0]).max() < 1e-7
                output = add(values[[0, -1]] if constant else values, kind)
                animation["samplers"].append(dict(input=pair if constant else full, output=output, interpolation="LINEAR"))
                animation["channels"].append(dict(sampler=len(animation["samplers"])-1, target=dict(node=index[i], path=channel)))
        doc["animations"].append(animation)
    doc["buffers"] = [dict(byteLength=len(blob))]
    encoded = json.dumps(doc, separators=(",", ":")).encode()
    encoded += b" "*((-len(encoded)) % 4)
    blob = bytes(blob)+b"\0"*((-len(blob)) % 4)
    data = struct.pack("<III", 0x46546C67, 2, 28+len(encoded)+len(blob))
    data += struct.pack("<II", len(encoded), 0x4E4F534A)+encoded+struct.pack("<II", len(blob), 0x004E4942)+blob
    Path(destination).write_bytes(data)
    return data


def skeleton_sidecar(target, rig_sha):
    sk = target.skel; keep = set(target.nodes)
    nodes = []
    for i in target.nodes:
        parent = sk.parent[i]
        nodes.append(dict(name=sk.names[i], parent=sk.names[parent] if parent in keep else None,
                          translation=[float(v) for v in sk.rest_t[i]], rotation=[float(v) for v in sk.rest_r[i]],
                          scale=[float(v) for v in sk.rest_s[i]]))
    return dict(sourceSha256=rig_sha, nodes=nodes)


def source_note(entry, seconds, **extra):
    note = dict(maker=entry["maker"], url=entry["url"], seconds=[round(float(seconds[0]), 4), round(float(seconds[1]), 4)])
    for name in ("task", "action", "actionId"):
        if name in entry:
            note[name] = entry[name]
    note.update(extra)
    return note


def _clean(value):
    if isinstance(value, (list, tuple)):
        return [_clean(v) for v in value]
    if isinstance(value, dict):
        return {k: _clean(v) for k, v in value.items()}
    if isinstance(value, (float, np.floating)):
        value = round(float(value), 4)
        return 0.0 if value == 0 else value
    if isinstance(value, np.integer):
        return int(value)
    return value


def finish(record):
    keep = {name: record[name] for name in ("fps", "duration", "markers")}
    record = _clean(record); record.update(keep)
    return record


def purchased_clips(key, target, sources, purchase, rig_path, moved_from=None):
    """The bought clips for `target`: on the rig they were bought for, or moved onto a class-mate's."""
    path = sources.path(purchase["file"])
    out = []
    for spec in purchase["clips"]:
        source = MeshySource(path, rig_path, spec["clip"])
        moved = moved_from is not None
        base = dict(maker="meshy", task=purchase["task"], action=spec["action"], actionId=spec["actionId"],
                    rigTask=purchase["rigTask"], url=purchase["file"]["url"])
        if moved:
            base["movedFrom"] = moved_from
        kind = spec["kind"]
        # Moved falls keep the donor's pelvis path, scaled by leg length, like every other moved clip, so the bought
        # and the moved versions of one clip differ only by the rig they play on.
        options = dict()
        if kind == "block":
            pose, info = bake(target, source, **options)
            events, found = guard_markers(pose)
            # Half a second of the arm coming up before the guard is set: the rest of the lead-in is idle sway.
            first = max(0, found["guard"]-int(GUARD_LEAD*FPS))
            stop = min(pose.frames-1, (found["recovery"] if found["recovery"] is not None else pose.frames-1)+int(.35*FPS))
            pose, info = bake(target, source, start=first/FPS, end=stop/FPS, **options)
            events, found = guard_markers(pose)
            events += plants_to_events(info, pose.frames-1)
            out.append((spec["id"], spec["tags"]+[found["hand"].replace("Hand", "").lower()], pose, events,
                        dict(base, seconds=[first/FPS, stop/FPS]), None))
        elif kind == "hit" and spec.get("cut") == "fall":
            pose, info = bake(target, source, **options)
            stop = max(int(.5*FPS), fall_frame(pose))
            pose, info = bake(target, source, start=0., end=stop/FPS, **options)
            events, found = hit_markers(pose, "hit")
            # It is cut where the fall begins: it never comes back, so it has no recovery.
            events = [e for e in events if e[0] != "recovery"]
            events += plants_to_events(info, pose.frames-1)
            out.append((spec["id"], spec["tags"], pose, events, dict(base, seconds=[0., stop/FPS]), None))
        elif kind == "hit" and spec.get("sides"):
            pose, info = bake(target, source, **options)
            events, found = hit_markers(pose, "hit")
            first = max(0, found["hit"]-int(.2*FPS))
            # The blow and the stagger, not the long rub of the cheek that follows: at most SIDE_HOLD after the hit.
            stop = min(pose.frames-1, (found.get("recovery") or pose.frames-1)+int(.3*FPS), found["hit"]+int(SIDE_HOLD*FPS))
            seconds = (first/FPS, stop/FPS)
            authored_pose, info = bake(target, source, start=seconds[0], end=seconds[1], **options)
            events, found = hit_markers(authored_pose, "hit")
            side = lean_side(authored_pose, found["hit"])
            events += plants_to_events(info, authored_pose.frames-1)
            out.append((f"hit.{side}", spec["tags"]+[side], authored_pose, events, dict(base, seconds=list(seconds)), None))
            other = "left" if side == "right" else "right"
            mirror_pose, info = bake(target, source, start=seconds[0], end=seconds[1], mirror=True, **options)
            events, found = hit_markers(mirror_pose, "hit")
            events += plants_to_events(info, mirror_pose.frames-1)
            out.append((f"hit.{other}", spec["tags"]+[other, "derived"], mirror_pose, events, dict(base, seconds=list(seconds), mirrored=True),
                        f"{spec['action']} ({spec['actionId']}) mirrored: struck from the {other}"))
        elif kind == "hit":
            pose, info = bake(target, source, **options)
            events, found = hit_markers(pose, "hit")
            events += plants_to_events(info, pose.frames-1)
            out.append((spec["id"], spec["tags"], pose, events, dict(base, seconds=[0., source.duration()]), None))
        elif kind == "death":
            pose, info = bake(target, source, **options)
            events, found = hit_markers(pose, "death")
            out.append((spec["id"], spec["tags"], pose, events, dict(base, seconds=[0., source.duration()], fall=fall_way(pose)), None))
        else:
            raise ValueError(kind)
    return out


def _motion_start(pose):
    """The first frame anything moves: where a clip's still lead-in ends."""
    chest = pose.pos("Spine"); hands = pose.pos("LeftHand")+pose.pos("RightHand")
    moved = np.linalg.norm(hands-hands[0], axis=1)+np.linalg.norm(chest-chest[0], axis=1)
    return _first(moved > .02, 0)


def bake_figure(key, sources, output, inspect=False):
    fig = FIGURES[key]
    rig_path = sources.path(fig["rig"]); target = RankRig(key, rig_path)
    print(f"[{key}] {fig['figure']}: height {target.height:.3f} m, ground {target.ground:.3f}, scale {target.scale}", flush=True)
    clips = []
    # The figure's own strike, cut round the blow.
    attack = MeshySource(sources.path(fig["attack"]), rig_path)
    pose, info, events, found, seconds = cut_strike(target, attack, fig["strike"], dict())
    print(f"[{key}] strike {fig['attack']['action']}: source {attack.duration():.2f}s cut {seconds[0]:.2f}-{seconds[1]:.2f}s,"
          f" frames {pose.frames}, ready {found['ready']} clash {found['clash']} contact {found['contact']} recovery {found['recovery']},"
          f" driver {found['driver']} at {found['speed']} m/s, reach {found['reachMetres']:.2f} m", flush=True)
    clips.append(("attack.strike", ["attack"]+fig["strike"]["tags"], pose, events, source_note(fig["attack"], seconds), None,
                  dict(contact=dict(driver=found["driver"], frame=found["contact"], reachMetres=found["reachMetres"]))))
    # Its own death, named by the way it falls.
    death = MeshySource(sources.path(fig["death"]), rig_path)
    pose, info = bake(target, death)
    events, found = hit_markers(pose, "death"); way = fall_way(pose)
    print(f"[{key}] death {fig['death']['action']}: {death.duration():.2f}s falls {way}, hit {found['hit']} land {found['land']}", flush=True)
    clips.append((f"death.{way}", ["death", way], pose, events, source_note(fig["death"], (0., death.duration())), None, None))
    # Bought clips: on this rig, or moved from a class-mate's.
    if key in PURCHASES:
        bought = purchased_clips(key, target, sources, PURCHASES[key], rig_path)
    elif key in MOVED:
        donor = MOVED[key]
        bought = purchased_clips(key, target, sources, PURCHASES[donor], sources.path(FIGURES[donor]["rig"]), moved_from=donor)
    else:
        bought = []
    held = {c[0] for c in clips}
    for clip_id, tags, pose, events, note, derived in bought:
        if clip_id in held:
            print(f"[{key}] {clip_id} from the purchase is not kept: the figure's own clip has that id", flush=True)
            continue
        held.add(clip_id)
        marks = {name: frame for name, frame in events if name in ("guard", "hit", "land", "recovery")}
        print(f"[{key}] {clip_id}: {pose.frames} frames {marks}" + (f" ({derived})" if derived else ""), flush=True)
        clips.append((clip_id, tags, pose, events, note, derived, None))
    if inspect:
        return None
    records, poses = [], []
    for clip_id, tags, pose, events, note, derived, extra in clips:
        record = clip_record(key, clip_id, tags, pose, events, note, extra)
        if derived:
            record["derived"] = derived
        records.append(finish(record)); poses.append(pose)
    data = write_library(target, records, poses, output/f"{key}.glb")
    return dict(records=records, bytes=len(data), sha256=sha256(data), rig_sha=fig["rig"]["sha256"], target=target)


def provenance():
    figures = {}
    for key, fig in FIGURES.items():
        entry = dict(figure=fig["figure"], kingdom=fig["kingdom"], kind=fig["kind"], weapon=fig["weapon"],
                     rig=dict(url=fig["rig"]["url"], sha256=fig["rig"]["sha256"], made=fig["rig"]["made"],
                              **({"task": fig["rig"]["task"]} if "task" in fig["rig"] else {}), licence=LICENCES[fig["rig"].get("maker", "rork")]),
                     clips=[dict(role=role, url=fig[role]["url"], sha256=fig[role]["sha256"], bytes=fig[role]["bytes"], action=fig[role]["action"],
                                 **{k: fig[role][k] for k in ("task", "actionId") if k in fig[role]}, licence=LICENCES[fig[role]["maker"]])
                            for role in ("attack", "death")])
        if key in PURCHASES:
            p = PURCHASES[key]
            entry["purchase"] = dict(task=p["task"], rigTask=p["rigTask"], bought=p["bought"], credits=p["credits"], file=p["file"],
                                     actions=[dict(actionId=c["actionId"], action=c["action"], clip=c["id"]) for c in p["clips"]],
                                     licence=LICENCES["meshy"])
        if key in MOVED:
            entry["moved"] = dict(fromFigure=MOVED[key], task=PURCHASES[MOVED[key]]["task"],
                                  method="combat_retarget.retarget: world-space rotation deltas from the donor rig's bind pose onto this rig's, "
                                         "pelvis path scaled by leg length, planted feet held with two-bone IK; falls pivot on the planted feet")
        figures[key] = entry
    return dict(version=VERSION, fps=FPS, figures=figures,
                method=dict(own="each figure's own strike and death retargeted from its own rig: authored motion, limb lengths reset to the rig's",
                            markers="read off the baked motion: contact where the strike's driver is fastest in front of the body (the "
                                    "Charged Slash's first swing is its clash), ready the last still frame before that run of speed, guard where "
                                    "the guarding hand reaches 95% of its travel, hit/land/recovery as combat-v2",
                            cut=f"a strike runs from just before anything moves (at most {WINDUP}s before the blow) to {TAIL}s after its recovery; "
                                f"a guard keeps {GUARD_LEAD}s of the arm coming up; a side hit keeps {SIDE_HOLD}s after the blow; "
                                "a hit from behind ends where its fall begins"))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache", action="append", default=[]); parser.add_argument("--output", required=True)
    parser.add_argument("--classes", default=",".join(FIGURES)); parser.add_argument("--inspect", action="store_true")
    argv = sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else sys.argv[1:]
    args = parser.parse_args(argv)
    output = Path(args.output); output.mkdir(parents=True, exist_ok=True)
    sources = Sources(args.cache)
    # Hashed with LF line ends, as the tests hash them: a Windows checkout may hand either script over with CRLF.
    lf = lambda path: path.read_bytes().replace(bytes([13, 10]), bytes([10]))
    generator = sha256(lf(Path(__file__))+lf(Path(__file__).parent/"combat_retarget.py"))
    prov = provenance(); prov_bytes = (json.dumps(prov, indent=2)+"\n").encode()
    if not args.inspect:
        (output/"provenance.json").write_bytes(prov_bytes)
    for key in [k for k in args.classes.split(",") if k]:
        result = bake_figure(key, sources, output, args.inspect)
        if result is None:
            continue
        fig = FIGURES[key]
        manifest = dict(version=VERSION, archetype=key, bytes=result["bytes"], sha256=result["sha256"], generatorSha256=generator,
                        provenance="provenance.json", provenanceSha256=sha256(prov_bytes),
                        figure=fig["figure"], kingdom=fig["kingdom"], kind=fig["kind"],
                        sources=[dict(role=role, url=fig[role]["url"], sha256=fig[role]["sha256"], bytes=fig[role]["bytes"]) for role in ("rig", "attack", "death")]
                        + ([dict(role="purchase", url=PURCHASES[key]["file"]["url"], sha256=PURCHASES[key]["file"]["sha256"], bytes=PURCHASES[key]["file"]["bytes"])] if key in PURCHASES else [])
                        + ([dict(role="moved", url=PURCHASES[MOVED[key]]["file"]["url"], sha256=PURCHASES[MOVED[key]]["file"]["sha256"],
                                 bytes=PURCHASES[MOVED[key]]["file"]["bytes"], fromFigure=MOVED[key])] if key in MOVED else []),
                        clips=result["records"])
        manifest["sources"][0]["role"] = "rigged"
        (output/f"{key}.json").write_text(json.dumps(manifest, indent=2)+"\n")
        (output/f"{key}-skeleton.json").write_text(json.dumps(skeleton_sidecar(result["target"], result["rig_sha"]), indent=2)+"\n")
        print(f"[{key}] wrote {result['bytes']} bytes, {len(result['records'])} clips", flush=True)


if __name__ == "__main__":
    main()
