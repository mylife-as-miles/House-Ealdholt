#!/usr/bin/env python3
"""Download the exact Poly Haven (CC0) sources used by the resident pipeline.

Developer intake tool; the game never fetches these at runtime. It reads the
per-asset Poly Haven info and files APIs, downloads the listed files at the
requested resolution, checks Poly Haven's published MD5 and size, and writes
``intake.json`` with SHA-256 hashes of every API response and file so the
provenance written beside committed assets can be reproduced.

    python3 scripts/characters/intake_polyhaven.py OUTPUT_DIR [--resolution 1k]

Only the Python standard library is used. Downloads land in a new directory
outside the repository; the build script reads them from there.
"""
import argparse
import hashlib
import json
import os
import sys
import urllib.request

# Asset id -> kind and the file roles needed. Every asset is published by Poly
# Haven as CC0-1.0; the info API is recorded per asset as evidence.
ASSETS = {
    "cross_pein_hammer": ("model", None),
    "rough_linen": ("texture", ("Diffuse", "nor_gl", "arm")),
    "caban": ("texture", ("Diffuse", "nor_gl", "arm")),
    "poly_wool_herringbone": ("texture", ("Diffuse", "nor_gl", "arm")),
    "brown_leather": ("texture", ("Diffuse", "nor_gl", "arm")),
    "fabric_leather_02": ("texture", ("Diffuse", "nor_gl", "arm")),
    "bark_brown_02": ("texture", ("Diffuse", "nor_gl", "arm")),
    # household members (spinner, child, elder)
    "curly_teddy_natural": ("texture", ("Diffuse", "nor_gl", "arm")),
    "hessian_230": ("texture", ("Diffuse", "nor_gl", "arm")),
    "wicker_basket_01": ("model", None),
    "wooden_bucket_01": ("model", None),
    "wooden_hammer_01": ("model", None),
    "wooden_stool_01": ("model", None),
    "wooden_spoon": ("model", None),
    "wooden_bowl_01": ("model", None),
}
API = "https://api.polyhaven.com"
USER_AGENT = "Crownfall-character-intake/1 (+https://github.com/mylife-as-miles/Crownfall)"


def fetch(url):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=120) as response:
        return response.read()


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def save(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as handle:
        handle.write(data)


def download(entry, path):
    data = fetch(entry["url"])
    if "md5" in entry and hashlib.md5(data).hexdigest() != entry["md5"]:
        raise SystemExit(f"MD5 mismatch for {entry['url']}")
    if "size" in entry and len(data) != entry["size"]:
        raise SystemExit(f"Size mismatch for {entry['url']}")
    save(path, data)
    return {"url": entry["url"], "bytes": len(data), "md5": entry.get("md5"), "sha256": sha256(data)}


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("output")
    parser.add_argument("--resolution", default="1k")
    args = parser.parse_args()
    out = os.path.abspath(args.output)
    if os.path.exists(out) and os.listdir(out):
        raise SystemExit("Choose a new, empty output directory.")
    os.makedirs(out, exist_ok=True)
    licence_page = fetch("https://polyhaven.com/license")
    record = {"tool": "scripts/characters/intake_polyhaven.py", "resolution": args.resolution,
              "licence": {"spdx": "CC0-1.0", "officialUrl": "https://polyhaven.com/license",
                          "officialPageSha256": sha256(licence_page)}, "assets": {}}
    for asset_id, (kind, roles) in ASSETS.items():
        info_raw = fetch(f"{API}/info/{asset_id}")
        files_raw = fetch(f"{API}/files/{asset_id}")
        info, files = json.loads(info_raw), json.loads(files_raw)
        entry = {"kind": kind, "name": info.get("name"), "authors": info.get("authors"),
                 "sourceUrl": f"https://polyhaven.com/a/{asset_id}",
                 "infoApi": f"{API}/info/{asset_id}", "filesApi": f"{API}/files/{asset_id}",
                 "infoSha256": sha256(info_raw), "filesSha256": sha256(files_raw), "files": {}}
        save(os.path.join(out, asset_id, "info.json"), info_raw)
        save(os.path.join(out, asset_id, "files.json"), files_raw)
        if kind == "model":
            gltf = files["gltf"][args.resolution]["gltf"]
            entry["files"]["gltf"] = download(gltf, os.path.join(out, asset_id, os.path.basename(gltf["url"])))
            for rel, inc in gltf.get("include", {}).items():
                entry["files"][rel] = download(inc, os.path.join(out, asset_id, rel))
        else:
            for role in roles:
                item = files[role][args.resolution]["jpg"]
                entry["files"][role] = download(item, os.path.join(out, asset_id, os.path.basename(item["url"])))
        record["assets"][asset_id] = entry
        print(f"{asset_id}: {len(entry['files'])} files", file=sys.stderr)
    with open(os.path.join(out, "intake.json"), "w") as handle:
        json.dump(record, handle, indent=1, sort_keys=True)
    print(os.path.join(out, "intake.json"))


if __name__ == "__main__":
    main()
