// August project registry.
// New projects follow the per-site layout: octrees + panoramas + models are
// served from the Cloudflare R2 bucket 'enable-pointclouds' (NOT the git repo).
// The viewer loads <folder>/cloud.js, derives the stations folder as
// <folder>/../../stations and the models folder as <folder>/../../models, so
// each site gets its own R2 prefix.
window.PROJECTS = {
  "hydrovault": {
    name: "hydrovault",
    folder: "tomken_shoring/pointclouds/hydrovault"
  },
  "410john": {
    name: "410 John Street",
    // Own R2 prefix (august/410john). 30.9M pts, 14 station panoramas.
    folder: "https://pub-3f436f87578a4223ae3a342484363f71.r2.dev/august/410john/pointclouds/410john"
  }
};
