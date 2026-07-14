// WJ Properties project registry.
// Octrees + panoramas are served from the Cloudflare R2 bucket 'enable-pointclouds'
// (NOT the git repo). The viewer loads <folder>/cloud.js and derives the stations
// folder as <folder>/../../stations, so the two 7-St-Dennis projects share the
// "wj/7stdennis" prefix to keep using the same stations manifest.
window.PROJECTS = {
  "southGarageSlab": {
    name: "7 St Dennis - South Garage Slab",
    folder: "https://pub-3f436f87578a4223ae3a342484363f71.r2.dev/wj/7stdennis/pointclouds/southGarageSlab"
  },
  "ph8": {
    name: "PH8",
    folder: "https://pub-3f436f87578a4223ae3a342484363f71.r2.dev/wj/140carlton/pointclouds/ph8"
  },
  "carltonwall": {
    name: "140 Carlton - Wall",
    folder: "https://pub-3f436f87578a4223ae3a342484363f71.r2.dev/wj/140carltonwall/pointclouds/wall"
  },
  "sprinkler_room": {
    name: "2560 Kingston Rd - Sprinkler Room",
    folder: "https://pub-3f436f87578a4223ae3a342484363f71.r2.dev/wj/2560kingston/pointclouds/sprinkler-room"
  },
  "7_st_dennis_scan": {
    name: "7 St Dennis - South Garage Slab (original scan)",
    folder: "https://pub-3f436f87578a4223ae3a342484363f71.r2.dev/wj/7stdennis/pointclouds/7_st_dennis_scan"
  }
};
