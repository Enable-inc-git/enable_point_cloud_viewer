"""Extract scan station poses and panoramic photos from a Trimble RealWorks project.

Reads the project's `<job>.scan` SQLite database (which holds the REGISTERED
station positions and orientations for every scan) and copies the user-chosen
panorama variant out of `scans/Images/HighResolution/`. Outputs a single
`stations.json` manifest plus a `panoramas/` folder ready to drop next to the
Potree octree the viewer is serving.

Why not parse the per-station E57 exports? Trimble exports per-station E57s
in each scanner's LOCAL frame (translation = (0,0,sensor_height)), so they
don't carry the registered positions. The .scan SQLite holds the canonical
post-registration poses.

Requirements: standard library only (sqlite3, json, shutil, argparse). PIL
is optional — used only to record image dimensions in the manifest.

Usage:
  python tools/extract_stations.py \\
    "<project_root>/Scans/<job>/<job>.scan" \\
    <output_dir> \\
    [--image-type 4177] [--offset X Y Z] [--copy|--symlink]

  <project_root>/Scans/<job>/ should contain `scans/Images/HighResolution/`.

  --image-type picks which colorization variant. Default 4177 (Trimble's
  highest-resolution full-RGB equirectangular panorama; 12192x6096).
  Other observed codes on a Trimble X7:
    4177    = full-res true color (default; recommended)
    8265-3  = half-res true color
    8266    = intensity grayscale
    8268    = intensity (white-balanced)
    9288    = pseudo-color intensity

  --offset is subtracted from every station position so the manifest lines up
  with whatever coordinate frame the Potree cloud is in. Tune it by reloading
  the viewer and watching the alignment toast / console deltas.

  --copy (default) duplicates the JPEG into output_dir/panoramas/.
  --symlink uses an OS symlink instead (faster, but Windows needs Developer
  Mode for non-admin symlink creation).
"""

import argparse
import datetime
import json
import os
import re
import shutil
import sqlite3
import sys
from pathlib import Path


_LOC_RE = re.compile(r"\(([^)]+)\)")


def parse_location(loc_str):
    """Parse Trimble's '(tx;ty;tz)(ax;ay;az)(bx;by;bz)' string.

    Returns (translation, rotation_3x3_row_major) where rotation columns
    are [a, b, a x b].
    """
    triplets = _LOC_RE.findall(loc_str)
    if len(triplets) < 3:
        raise ValueError("location string missing triplets: " + loc_str)
    t = list(map(float, triplets[0].split(";")))
    a = list(map(float, triplets[1].split(";")))
    b = list(map(float, triplets[2].split(";")))
    # Third column = a x b (right-handed)
    c = [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
    # Row-major 3x3 with columns [a, b, c]
    rot = [
        [a[0], b[0], c[0]],
        [a[1], b[1], c[1]],
        [a[2], b[2], c[2]],
    ]
    return t, rot


def rotation_matrix_to_quat(m):
    """Convert a 3x3 rotation matrix (row-major) to a THREE.js-order quaternion (x,y,z,w)."""
    # Shepperd's method — numerically stable.
    m00, m01, m02 = m[0]
    m10, m11, m12 = m[1]
    m20, m21, m22 = m[2]
    trace = m00 + m11 + m22
    if trace > 0:
        s = 0.5 / (trace + 1.0) ** 0.5
        w = 0.25 / s
        x = (m21 - m12) * s
        y = (m02 - m20) * s
        z = (m10 - m01) * s
    elif m00 > m11 and m00 > m22:
        s = 2.0 * ((1.0 + m00 - m11 - m22) ** 0.5)
        w = (m21 - m12) / s
        x = 0.25 * s
        y = (m01 + m10) / s
        z = (m02 + m20) / s
    elif m11 > m22:
        s = 2.0 * ((1.0 + m11 - m00 - m22) ** 0.5)
        w = (m02 - m20) / s
        x = (m01 + m10) / s
        y = 0.25 * s
        z = (m12 + m21) / s
    else:
        s = 2.0 * ((1.0 + m22 - m00 - m11) ** 0.5)
        w = (m10 - m01) / s
        x = (m02 + m20) / s
        y = (m12 + m21) / s
        z = 0.25 * s
    return [x, y, z, w]


def get_image_size(path):
    try:
        from PIL import Image
    except ImportError:
        return (0, 0)
    try:
        with Image.open(path) as img:
            return img.size  # (w, h)
    except Exception:
        return (0, 0)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("scan_db", help="Path to the project's <Job>.scan SQLite database")
    ap.add_argument("output_dir", help="Directory to write stations.json + panoramas/ into")
    ap.add_argument("--image-type", default="4177",
                    help="Image type code to use (default: 4177 = full-res RGB)")
    ap.add_argument("--image-dir", default=None,
                    help="Override the source JPG folder (defaults to "
                         "<db_dir>/scans/Images/HighResolution). Use this when the "
                         "<idx>-<type>.jpg panoramas have been pulled into a flat folder.")
    ap.add_argument("--offset", nargs=3, type=float, metavar=("X", "Y", "Z"),
                    help="Subtracted from each station position to match the displayed Potree cloud frame")
    ap.add_argument("--match-by", choices=("index", "name"), default="index",
                    help="Which DB column the JPG filename prefix corresponds to. "
                         "Default 'index' (Scan.Index). Use 'name' when the job contains extra "
                         "sub-scan rows (e.g. 'Area 1') that push Index out of step with Name — "
                         "matching by Index there pins the WRONG panorama to every later station. "
                         "When Name == str(Index) (the usual case) both modes are identical.")
    ap.add_argument("--min-pano-width", type=int, default=1024,
                    help="Reject source JPGs narrower than this as panoramas (default 1024). "
                         "Trimble emits tiny placeholder JPGs (a few dozen px) for sub-scan rows "
                         "that have no real panorama; without this they'd be published as valid.")
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--copy", action="store_true", default=True,
                      help="Copy JPEGs into output_dir/panoramas/ (default)")
    mode.add_argument("--symlink", action="store_true",
                      help="Symlink JPEGs instead of copying")
    args = ap.parse_args()

    db_path = Path(args.scan_db).resolve()
    if not db_path.exists():
        print("ERROR: scan database not found: " + str(db_path), file=sys.stderr)
        sys.exit(1)

    project_dir = db_path.parent       # .../<Job>/
    if args.image_dir:
        images_dir = Path(args.image_dir).resolve()
    else:
        images_dir = project_dir / "scans" / "Images" / "HighResolution"
    if not images_dir.exists():
        print("ERROR: image folder not found at: " + str(images_dir), file=sys.stderr)
        sys.exit(1)

    output_dir = Path(args.output_dir).resolve()
    panoramas_dir = output_dir / "panoramas"
    panoramas_dir.mkdir(parents=True, exist_ok=True)

    offset = args.offset or [0.0, 0.0, 0.0]
    image_type = args.image_type

    print("Reading: " + str(db_path))
    con = sqlite3.connect(str(db_path))
    cur = con.cursor()
    rows = cur.execute(
        'SELECT "Index", "Name", "Location", "FilePath", "PanoramaType", "ColorizedType" '
        'FROM "Scan" ORDER BY "Index"'
    ).fetchall()
    print("Found {:d} stations in DB.".format(len(rows)))

    stations_out = []
    overall_min = [float("inf")] * 3
    overall_max = [float("-inf")] * 3
    n_with = 0
    n_skipped = 0
    for idx, name, loc_str, fp, ptype, ctype in rows:
        try:
            trans, rot = parse_location(loc_str)
        except Exception as exc:
            print("  WARN: station {:d} ('{}') has bad Location: {}".format(idx, name, exc), file=sys.stderr)
            continue
        quat = rotation_matrix_to_quat(rot)

        # Source panorama for this station + selected type.
        # The filename prefix is the DB Index by default, but jobs containing sub-scan rows
        # ('Area 1' etc.) have Index out of step with Name — see --match-by.
        key = idx if args.match_by == "index" else str(name)
        src_jpg = images_dir / "{}-{}.jpg".format(key, image_type)
        has_pano = src_jpg.exists()
        out_rel = None
        img_w = 0
        img_h = 0
        if has_pano:
            # Reject Trimble's tiny placeholder JPGs before they reach the manifest.
            probe_w, probe_h = get_image_size(src_jpg)
            if probe_w and probe_w < args.min_pano_width:
                print("  --:  station {:>2d} ('{}') '{}' is {}x{}, below --min-pano-width {} "
                      "- treating as NO panorama".format(idx, name, src_jpg.name, probe_w,
                                                         probe_h, args.min_pano_width))
                has_pano = False
                n_skipped += 1
        if has_pano:
            out_name = "station_{:03d}.jpg".format(idx)
            out_path = panoramas_dir / out_name
            try:
                if out_path.exists() or out_path.is_symlink():
                    out_path.unlink()
                if args.symlink:
                    os.symlink(str(src_jpg), str(out_path))
                else:
                    shutil.copy2(str(src_jpg), str(out_path))
            except Exception as exc:
                print("  WARN: failed to copy/symlink {}: {}".format(src_jpg.name, exc), file=sys.stderr)
                has_pano = False
            if has_pano:
                out_rel = "panoramas/" + out_name
                img_w, img_h = get_image_size(src_jpg)
                print("  OK:  station {:>2d} ('{}') -> {}  ({}x{})".format(idx, name, out_name, img_w, img_h))
                n_with += 1
        else:
            n_skipped += 1
            print("  --:  station {:>2d} ('{}') has no '{}-{}.jpg'".format(idx, name, key, image_type))

        shifted = [trans[0] - offset[0], trans[1] - offset[1], trans[2] - offset[2]]
        for ax in range(3):
            if shifted[ax] < overall_min[ax]: overall_min[ax] = shifted[ax]
            if shifted[ax] > overall_max[ax]: overall_max[ax] = shifted[ax]

        stations_out.append({
            "id": "station_{:03d}".format(idx),
            "name": str(name),
            "index": int(idx),
            "position": shifted,
            "rotation_quat": quat,
            "panorama": out_rel,
            "panorama_projection": "equirectangular" if has_pano else None,
            "image_width": img_w,
            "image_height": img_h,
            "has_panorama": has_pano,
            "panorama_image_type": image_type if has_pano else None,
        })

    manifest = {
        "version": 1,
        "source_db": db_path.name,
        "image_source_dir": str(images_dir),
        "image_type": image_type,
        "generated": datetime.datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "applied_offset": offset,
        "station_bbox": {
            "min": overall_min if overall_min[0] != float("inf") else None,
            "max": overall_max if overall_max[0] != float("-inf") else None,
        } if stations_out else None,
        "stations": stations_out,
    }

    manifest_path = output_dir / "stations.json"
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)

    print()
    print("Wrote: " + str(manifest_path))
    print("Stations: {:d} total, {:d} with panoramas ({} not generated yet).".format(
        len(stations_out), n_with, n_skipped))
    if offset != [0.0, 0.0, 0.0]:
        print("Applied offset: " + str(offset))


if __name__ == "__main__":
    main()
