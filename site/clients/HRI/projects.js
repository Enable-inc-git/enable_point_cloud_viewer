// HRI project registry.
// Octrees, panoramas, and GLB models are served from the Cloudflare R2 bucket
// 'enable-pointclouds' (NOT the git repo). `folder` is an absolute R2 URL.
//
// Multi-scan: `folder` is the PRIMARY cloud; `clouds[]` lists every cloud to load
// with a per-cloud visibility default (shown in the right-hand "Scans" panel).
// The viewer derives <project>/stations and <project>/models from `folder` root.
window.PROJECTS = {
  "40larch1": {
    name: "40 Larch 1",
    folder: "https://pub-3f436f87578a4223ae3a342484363f71.r2.dev/hri/40larch1/pointclouds/scan",
    clouds: [
      { id: "scan",  name: "Scan",   folder: "https://pub-3f436f87578a4223ae3a342484363f71.r2.dev/hri/40larch1/pointclouds/scan",  visible: true  },
      { id: "gprhd", name: "GPR HD", folder: "https://pub-3f436f87578a4223ae3a342484363f71.r2.dev/hri/40larch1/pointclouds/gprhd", visible: true }
    ]
  },
  "30weston": {
    name: "30 Weston Rd",
    folder: "https://pub-3f436f87578a4223ae3a342484363f71.r2.dev/hri/30weston/pointclouds/bridgeScan",
    clouds: [
      { id: "bridgeScan", name: "Bridge scan", folder: "https://pub-3f436f87578a4223ae3a342484363f71.r2.dev/hri/30weston/pointclouds/bridgeScan", visible: true }
    ]
  }
};
