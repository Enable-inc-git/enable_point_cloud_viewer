// Pomerleau project registry.
// Octree + panoramas are served from the Cloudflare R2 bucket 'enable-pointclouds'
// (NOT the git repo). The viewer loads <folder>/cloud.js and derives the stations
// folder as <folder>/../../stations, so the octree lives under
// pomerleau/harthouse/pointclouds/harthouse and stations under pomerleau/harthouse/stations.
window.PROJECTS = {
  "hart_house": {
    name: "Hart House",
    folder: "https://pub-3f436f87578a4223ae3a342484363f71.r2.dev/pomerleau/harthouse/pointclouds/harthouse"
  }
};
