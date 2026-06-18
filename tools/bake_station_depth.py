"""Prototype: bake an equirectangular DEPTH map for one scan station by
projecting the registered point cloud from that station's pose.

Produces a side-by-side (RGB panorama on top, colorized depth below) so the
geometry/convention can be eyeballed against the photo before we commit to
baking all stations + wiring occlusion into the panorama overlay.

Usage:
  python tools/bake_station_depth.py <stations.json> <cloud.las> <station_index> <out.png> [--w 4096]
"""
import argparse, json, sys
import numpy as np
from pathlib import Path
from PIL import Image, ImageFilter
import laspy


def quat_to_R(q):
    x, y, z, w = q
    return np.array([
        [1-2*(y*y+z*z), 2*(x*y-z*w),   2*(x*z+y*w)],
        [2*(x*y+z*w),   1-2*(x*x+z*z), 2*(y*z-x*w)],
        [2*(x*z-y*w),   2*(y*z+x*w),   1-2*(x*x+y*y)],
    ], dtype=np.float64)


def turbo(v):
    # cheap turbo-ish colormap, v in [0,1] -> (r,g,b) uint8 arrays
    v = np.clip(v, 0, 1)
    r = np.clip(1.5 - abs(4*v - 3), 0, 1)
    g = np.clip(1.5 - abs(4*v - 2), 0, 1)
    b = np.clip(1.5 - abs(4*v - 1), 0, 1)
    return (np.stack([r, g, b], -1) * 255).astype(np.uint8)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("stations_json"); ap.add_argument("cloud_las")
    ap.add_argument("station_index", type=int); ap.add_argument("out_png")
    ap.add_argument("--w", type=int, default=4096)
    a = ap.parse_args()
    W = a.w; H = W // 2

    man = json.load(open(a.stations_json))
    stations = man["stations"] if isinstance(man, dict) else man
    st = next((s for s in stations if int(s.get("index", -1)) == a.station_index), None)
    if st is None:
        print("station index %d not found" % a.station_index); sys.exit(1)
    t = np.array(st["position"], dtype=np.float64)
    R = quat_to_R(st["rotation_quat"])
    print("station %s  name=%s  pos=%s" % (st["id"], st["name"], [round(v,3) for v in t]))

    print("reading LAS ...")
    las = laspy.read(a.cloud_las)
    P = np.column_stack([np.asarray(las.x), np.asarray(las.y), np.asarray(las.z)]).astype(np.float64)
    print("  points:", len(P))

    # world -> station-local frame
    local = (P - t) @ R           # local = R^T (P - t)
    x, y, z = local[:, 0], local[:, 1], local[:, 2]
    r = np.sqrt(x*x + y*y + z*z)
    good = r > 1e-3
    x, y, z, r = x[good], y[good], z[good], r[good]

    az = np.arctan2(y, x)                 # [-pi, pi]
    el = np.arcsin(np.clip(z / r, -1, 1)) # [-pi/2, pi/2]
    u = ((az + np.pi) / (2*np.pi) * W).astype(np.int64) % W
    v = ((np.pi/2 - el) / np.pi * H).astype(np.int64)
    v = np.clip(v, 0, H-1)

    # z-buffer: nearest range per pixel
    depth = np.full(W*H, np.inf, dtype=np.float64)
    flat = v * W + u
    np.minimum.at(depth, flat, r)
    depth = depth.reshape(H, W)
    filled = np.isfinite(depth)
    print("  coverage: %.1f%%  range min/med/max = %.2f / %.2f / %.2f m" % (
        100*filled.mean(), depth[filled].min(), np.median(depth[filled]), depth[filled].max()))

    # normalize by percentile (robust to far outliers), near=bright
    finite = depth[filled]
    lo, hi = np.percentile(finite, 1), np.percentile(finite, 99)
    norm = np.zeros((H, W), dtype=np.float64)
    norm[filled] = np.clip((depth[filled] - lo) / max(hi - lo, 1e-6), 0, 1)
    near = np.where(filled, 1.0 - norm, 0.0)  # near -> bright

    # light hole-fill for viewing (MaxFilter pulls nearby 'near' values into gaps)
    near_img = Image.fromarray((near*255).astype(np.uint8))
    near_filled = near_img.filter(ImageFilter.MaxFilter(3))

    color = turbo(np.asarray(near_filled, dtype=np.float64)/255.0)
    color[(np.asarray(near_filled) == 0)] = 0  # keep true gaps black
    depth_rgb = Image.fromarray(color)

    # stack under the RGB panorama (downscaled to match)
    pano_path = Path(a.stations_json).parent / st["panorama"]
    if pano_path.exists():
        pano = Image.open(pano_path).convert("RGB").resize((W, H))
        combo = Image.new("RGB", (W, 2*H))
        combo.paste(pano, (0, 0)); combo.paste(depth_rgb, (0, H))
        combo.save(a.out_png)
        print("wrote side-by-side ->", a.out_png)
    else:
        depth_rgb.save(a.out_png)
        print("wrote depth (no pano found) ->", a.out_png)


if __name__ == "__main__":
    main()
