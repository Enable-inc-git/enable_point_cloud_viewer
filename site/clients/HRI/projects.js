// HRI project registry.
// Folder paths are relative to this client's viewer.html (clients/HRI/).
//
// Multi-scan: `folder` is the PRIMARY cloud (loaded as the main point cloud and
// used for fit-to-screen / model base / station base). `clouds[]` lists every
// cloud to load with a per-cloud visibility default; they all appear in the
// right-hand "Scans" panel with view/hide toggles.
window.PROJECTS = {
  "40larch1": {
    name: "40 Larch 1",
    folder: "40 Larch 1/pointclouds/scan",
    clouds: [
      { id: "scan", name: "Scan", folder: "40 Larch 1/pointclouds/scan", visible: true }
    ]
  }
};
