"""Production depth bake for a scan station: equirectangular depth map with
16-bit depth packed into R(hi)/G(lo) channels, hole-filled, for use as an
occlusion texture in the panorama model overlay.

Convention (matches the verified panorama mapping):
  local = R^T (P - stationPos);  az = atan2(localY, localX);  el = asin(localZ/r)
  u = (az+pi)/(2pi);  v = (pi/2 - el)/pi   (row 0 = top = +90 elevation)
Decode in GLSL:  range = (R*256 + G)/257 * DEPTH_SCALE   (R,G in [0,1])
Empty pixels = (0,0,0) -> no occluder.

Usage:
  python tools/bake_station_depth_prod.py <stations.json> <cloud.las> <idx> <out_packed.png> [--w 2048] [--scale 50] [--fillcap 5]
"""
import argparse, json, sys
import numpy as np
from pathlib import Path
from PIL import Image
import laspy
from scipy import ndimage


def quat_to_R(q):
    x, y, z, w = q
    return np.array([
        [1-2*(y*y+z*z), 2*(x*y-z*w),   2*(x*z+y*w)],
        [2*(x*y+z*w),   1-2*(x*x+z*z), 2*(y*z-x*w)],
        [2*(x*z-y*w),   2*(y*z+x*w),   1-2*(x*x+y*y)],
    ], dtype=np.float64)


def turbo(v):
    v = np.clip(v, 0, 1)
    r = np.clip(1.5 - abs(4*v - 3), 0, 1)
    g = np.clip(1.5 - abs(4*v - 2), 0, 1)
    b = np.clip(1.5 - abs(4*v - 1), 0, 1)
    return (np.stack([r, g, b], -1) * 255).astype(np.uint8)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("stations_json"); ap.add_argument("cloud_las")
    ap.add_argument("idx", type=int); ap.add_argument("out_png")
    ap.add_argument("--w", type=int, default=2048)
    ap.add_argument("--scale", type=float, default=50.0)
    ap.add_argument("--fillcap", type=int, default=5, help="max px distance to hole-fill")
    a = ap.parse_args()
    W = a.w; H = W // 2; SCALE = a.scale

    man = json.load(open(a.stations_json))
    stations = man["stations"] if isinstance(man, dict) else man
    st = next((s for s in stations if int(s.get("index", -1)) == a.idx), None)
    if st is None:
        print("station idx %d not found" % a.idx); sys.exit(1)
    t = np.array(st["position"], dtype=np.float64)
    R = quat_to_R(st["rotation_quat"])
    print("station %s name=%s pos=%s scale=%.1fm res=%dx%d" % (
        st["id"], st["name"], [round(v,3) for v in t], SCALE, W, H))

    las = laspy.read(a.cloud_las)
    P = np.column_stack([np.asarray(las.x), np.asarray(las.y), np.asarray(las.z)]).astype(np.float64)
    print("points:", len(P))

    local = (P - t) @ R
    x, y, z = local[:, 0], local[:, 1], local[:, 2]
    r = np.sqrt(x*x + y*y + z*z)
    good = r > 1e-3
    x, y, z, r = x[good], y[good], z[good], r[good]
    az = np.arctan2(y, x)
    el = np.arcsin(np.clip(z / r, -1, 1))
    u = ((az + np.pi) / (2*np.pi) * W).astype(np.int64) % W
    v = np.clip(((np.pi/2 - el) / np.pi * H).astype(np.int64), 0, H-1)

    depth = np.full(W*H, np.inf)
    np.minimum.at(depth, v*W + u, r)
    depth = depth.reshape(H, W)
    valid = np.isfinite(depth)
    print("raw coverage: %.1f%%" % (100*valid.mean()))

    # hole-fill: nearest valid depth, capped by distance so big gaps (sky) stay empty
    dist, (iy, ix) = ndimage.distance_transform_edt(~valid, return_indices=True)
    filled = depth[iy, ix]
    fill_mask = (~valid) & (dist <= a.fillcap)
    out = np.where(valid, depth, np.where(fill_mask, filled, np.inf))
    out_valid = np.isfinite(out)
    print("filled coverage: %.1f%% (cap %d px)" % (100*out_valid.mean(), a.fillcap))

    # pack 16-bit into R/G; empty -> (0,0,0)
    norm = np.clip(np.where(out_valid, out, 0.0) / SCALE, 0, 1)
    v16 = np.round(norm * 65535).astype(np.uint32)
    Rc = ((v16 >> 8) & 255).astype(np.uint8)
    Gc = (v16 & 255).astype(np.uint8)
    Rc[~out_valid] = 0; Gc[~out_valid] = 0
    packed = np.dstack([Rc, Gc, np.zeros_like(Rc)])
    Image.fromarray(packed, "RGB").save(a.out_png)
    print("wrote packed depth ->", a.out_png)

    # colorized preview for eyeballing
    fin = out[out_valid]
    lo, hi = np.percentile(fin, 1), np.percentile(fin, 99)
    nn = np.zeros((H, W)); nn[out_valid] = np.clip((out[out_valid]-lo)/max(hi-lo,1e-6), 0, 1)
    near = np.where(out_valid, 1.0-nn, 0.0)
    col = turbo(near); col[~out_valid] = 0
    prev = Path(a.out_png).with_name(Path(a.out_png).stem + "_view.png")
    Image.fromarray(col).save(prev)
    print("wrote preview ->", prev)


if __name__ == "__main__":
    main()
