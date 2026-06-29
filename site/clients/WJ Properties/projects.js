// WJ Properties project registry.
// Folder paths are relative to this client's viewer.html (clients/WJ Properties/).
//
// Multi-scan: `folder` is the PRIMARY cloud (loaded as the main point cloud and
// used for fit-to-screen / model base / station base). Optional `clouds[]` lists
// every cloud to load with a per-cloud visibility default; with a single cloud
// it is omitted (no "Scans" panel is shown).
window.PROJECTS = {
  "southGarageSlab": {
    name: "7 St Dennis - South Garage Slab",
    folder: "7 St Dennis - South Garage Slab/pointclouds/southGarageSlab"
  },
  "ph8": {
    name: "PH8",
    folder: "140 Carlton/pointclouds/ph8"
  },
  "sprinkler_room": {
    name: "2560 Kingston Rd - Sprinkler Room",
    folder: "2560 kingston rd/pointclouds/sprinkler-room"
  },
  "7_st_dennis_scan": {
    name: "7 St Dennis - South Garage Slab (original scan)",
    folder: "7 St Dennis - South Garage Slab/pointclouds/7_st_dennis_scan"
  }
};
