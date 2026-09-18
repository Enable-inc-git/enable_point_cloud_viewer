// BDA project registry.
// Jarvis is still served from the git repo (relative path). St. Joseph's Hamilton
// is served from the Cloudflare R2 bucket 'enable-pointclouds' (absolute URL) — the
// viewer loads <folder>/cloud.js and derives <folder>/../../stations from it.
window.PROJECTS = {
  "jarvis": {
    name: "222 Jarvis Elevator 4",
    folder: "https://pub-3f436f87578a4223ae3a342484363f71.r2.dev/bda/jarvis/pointclouds/scan",
    // Tekla structural model (models/model.glb on R2). Opt-in: load it on startup
    // instead of leaving it as an on-demand "Load" row in the Models panel.
    autoLoadModels: true,
    // Opening camera + crop, captured from the viewer's own "View 1" snapshot
    // 2026-09-17: looking up the stairwell with the new beam in frame. The crop
    // trims only the +X and +Y faces (X max 5.754 -> 4.708, Y max 4.344 -> 2.569);
    // min corner and Z are the scan's full extents.
    initialView: {
      cam: {
        position: { x: -0.001598, y: 8.070512, z: 4.347782 },
        yaw: 3.412, pitch: -0.114296, radius: 8.714283,
        mode: 1                                   // 1 = perspective
      },
      clip: {
        initial: {
          position: { x: 1.922464, y: 0.438031, z: 3.420500 },
          rotation: { x: 0, y: 0, z: 0 },
          scale:    { x: 5.570002, y: 4.261508, z: 6.801000 }
        }
      }
    }
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
    // Load models/model.glb on startup instead of leaving it as an on-demand
    // "Load" row in the Models panel. The offset above is applied either way.
    autoLoadModels: true,
    clouds: [
      { id: "scan",    name: "Main Scan", folder: "https://pub-3f436f87578a4223ae3a342484363f71.r2.dev/bda/stjoseph/pointclouds/scan",    visible: true },
      { id: "columns", name: "Columns",   folder: "https://pub-3f436f87578a4223ae3a342484363f71.r2.dev/bda/stjoseph/pointclouds/columns", visible: true }
    ]
  }
};
