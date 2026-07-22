// BDA project registry.
// Jarvis is still served from the git repo (relative path). St. Joseph's Hamilton
// is served from the Cloudflare R2 bucket 'enable-pointclouds' (absolute URL) — the
// viewer loads <folder>/cloud.js and derives <folder>/../../stations from it.
window.PROJECTS = {
  "jarvis": {
    name: "222 Jarvis Elevator 4",
    folder: "https://pub-3f436f87578a4223ae3a342484363f71.r2.dev/bda/jarvis/pointclouds/scan"
  },
  "stjoseph": {
    name: "St. Joseph's Hamilton",
    // Primary cloud (loaded by the main flow). clouds[] lists every cloud shown
    // in the right-hand "Scans" panel with per-scan show/hide toggles.
    folder: "https://pub-3f436f87578a4223ae3a342484363f71.r2.dev/bda/stjoseph/pointclouds/scan",
    // model.glb was aligned to the scan by translating the SCAN +9150.00mm X and
    // +32166.95mm Y. We shift the MODEL by the negative instead (keeps stations /
    // second scan / marks in place). Metres, Potree Z-up world frame.
    modelOffset: { x: -9.15, y: -32.16695, z: 0 },
    clouds: [
      { id: "scan",    name: "Main Scan", folder: "https://pub-3f436f87578a4223ae3a342484363f71.r2.dev/bda/stjoseph/pointclouds/scan",    visible: true },
      { id: "columns", name: "Columns",   folder: "https://pub-3f436f87578a4223ae3a342484363f71.r2.dev/bda/stjoseph/pointclouds/columns", visible: true }
    ]
  }
};
